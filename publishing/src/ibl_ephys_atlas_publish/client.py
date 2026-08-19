from __future__ import annotations
import hashlib, json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


def file_info(path: Path) -> dict:
    h=hashlib.sha256()
    with path.open('rb') as f:
        while c:=f.read(4*1024*1024): h.update(c)
    return {'size':path.stat().st_size,'sha256':h.hexdigest()}

class PublishingClient:
    def __init__(self, base_url:str, token:str): self.base_url=base_url.rstrip('/'); self.token=token
    def _req(self, method, path, data=None, body=None, headers=None):
        hdr={'Authorization':f'Bearer {self.token}', **(headers or {})}
        if data is not None: body=json.dumps(data).encode(); hdr['Content-Type']='application/json'
        r=Request(self.base_url+path, data=body, headers=hdr, method=method)
        try:
            with urlopen(r) as resp: return json.loads(resp.read() or b'{}')
        except HTTPError as e:
            detail=e.read().decode(); raise RuntimeError(f'{e.code}: {detail}') from e
    def create_dataset(self,dataset_id,metadata=None): return self._req('POST','/api/datasets',{'dataset_id':dataset_id,'metadata':metadata or {}})
    def list_datasets(self): return self._req('GET','/api/datasets')
    def create_upload(self,dataset_id,release_id,artifacts,metadata=None): return self._req('POST',f'/api/datasets/{quote(dataset_id)}/uploads',{'release_id':release_id,'artifacts':artifacts,'metadata':metadata or {}})
    def upload_status(self,upload_id): return self._req('GET',f'/api/uploads/{upload_id}')
    def upload_file(self,upload_id,artifact_path,local_path,chunk_size=8*1024*1024):
        status=self.upload_status(upload_id); target=next(a for a in status['artifacts'] if a['path']==artifact_path); offset=target['offset']
        with Path(local_path).open('rb') as f:
            f.seek(offset)
            while chunk:=f.read(chunk_size):
                out=self._req('PUT',f'/api/uploads/{upload_id}/files/'+quote(artifact_path,safe='/'),body=chunk,headers={'Content-Type':'application/octet-stream','Upload-Offset':str(offset)})
                offset=out['offset']
        return offset
    def publish_upload(self,upload_id,aliases=None): return self._req('POST',f'/api/uploads/{upload_id}/publish',{'aliases':aliases or []})
    def publish_directory(self,dataset_id,release_id,root,aliases=None,metadata=None,chunk_size=8*1024*1024):
        root=Path(root); artifacts=[]
        for p in sorted(x for x in root.rglob('*') if x.is_file()):
            rel=p.relative_to(root).as_posix(); info=file_info(p); artifacts.append({'path':rel,**info})
        upload=self.create_upload(dataset_id,release_id,artifacts,metadata)
        for a in artifacts: self.upload_file(upload['upload_id'],a['path'],root/a['path'],chunk_size)
        return self.publish_upload(upload['upload_id'],aliases)
    def resume_directory(self,upload_id,root,aliases=None,chunk_size=8*1024*1024):
        root=Path(root); status=self.upload_status(upload_id)
        local=[]
        for p in sorted(x for x in root.rglob('*') if x.is_file()):
            rel=p.relative_to(root).as_posix(); local.append({'path':rel,**file_info(p)})
        declared=[{k:a[k] for k in ('path','size','sha256')} for a in status['artifacts']]
        if local != declared: raise ValueError('local directory does not match upload manifest')
        for a in local: self.upload_file(upload_id,a['path'],root/a['path'],chunk_size)
        return self.publish_upload(upload_id,aliases)
    def set_alias(self,dataset_id,alias,release_id): return self._req('PUT',f'/api/datasets/{quote(dataset_id)}/aliases/{quote(alias)}',{'release_id':release_id})
    def archive_dataset(self,dataset_id): return self._req('POST',f'/api/datasets/{quote(dataset_id)}/archive',{})
