import hashlib, json, os, sys, threading
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).parents[1]/'src'))
from ibl_ephys_atlas_publish.auth import CredentialRegistry, issue_credential, revoke_credential
from ibl_ephys_atlas_publish.client import PublishingClient
from ibl_ephys_atlas_publish.core import PublicationStore, OffsetConflict, ValidationError
from ibl_ephys_atlas_publish.service import PublishingApplication

def art(path,data): return {'path':path,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
def test_credentials_revocable_and_private(tmp_path):
    p=tmp_path/'creds.json'; cid,t=issue_credential(p,label='x',can_create_datasets=True); r=CredentialRegistry(p); assert r.authenticate(t)['id']==cid
    if os.name=='posix': assert p.stat().st_mode & 0o077 == 0
    revoke_credential(p,cid); assert r.authenticate(t) is None

def test_atomic_release_alias_resume_and_archive(tmp_path):
    s=PublicationStore(tmp_path); s.create_dataset('d',{},'c'); data=b'abcdef'; u=s.create_upload('d','r1',[art('x.bin',data)],{},'c')
    assert not (tmp_path/'public/datasets/d/releases/r1').exists(); s.append_artifact(u['upload_id'],'x.bin',0,data[:2])
    with pytest.raises(OffsetConflict): s.append_artifact(u['upload_id'],'x.bin',0,b'x')
    s.append_artifact(u['upload_id'],'x.bin',2,data[2:]); s.publish_upload(u['upload_id'],['latest'],'c')
    assert (tmp_path/'public/datasets/d/releases/r1/x.bin').read_bytes()==data; assert s.get_dataset('d')['aliases']['latest']=='r1'
    s.archive_dataset('d','c'); cat=s.list_datasets(); assert not cat['datasets'] and cat['archived_datasets'][0]['dataset_id']=='d'

def test_bad_sha_never_publishes(tmp_path):
    s=PublicationStore(tmp_path); s.create_dataset('d',{},'c'); u=s.create_upload('d','r',[art('x',b'good')],{},'c'); s.append_artifact(u['upload_id'],'x',0,b'bad!')
    with pytest.raises(ValidationError): s.publish_upload(u['upload_id'],[],'c')
    assert not (tmp_path/'public/datasets/d/releases/r').exists()

def test_external_validator_blocks(tmp_path):
    s=PublicationStore(tmp_path,validator_command=[sys.executable,'-c','import sys;sys.exit(2)']); s.create_dataset('d',{},'c'); u=s.create_upload('d','r',[art('x',b'x')],{},'c'); s.append_artifact(u['upload_id'],'x',0,b'x')
    with pytest.raises(ValidationError): s.publish_upload(u['upload_id'],[],'c')

def test_http_client_end_to_end(tmp_path):
    from wsgiref.simple_server import make_server
    cp=tmp_path/'creds'; _,token=issue_credential(cp,label='p',can_create_datasets=True); store=PublicationStore(tmp_path/'store'); app=PublishingApplication(store,CredentialRegistry(cp)); srv=make_server('127.0.0.1',0,app); th=threading.Thread(target=srv.serve_forever,daemon=True); th.start()
    try:
        root=tmp_path/'release'; root.mkdir(); (root/'manifest.json').write_text('{"x":1}'); (root/'big.bin').write_bytes(b'0123456789'*1000)
        c=PublishingClient(f'http://127.0.0.1:{srv.server_port}',token); c.create_dataset('d'); c.publish_directory('d','r1',root,['latest'],chunk_size=257)
        assert (store.public/'datasets/d/releases/r1/big.bin').read_bytes()==b'0123456789'*1000
    finally: srv.shutdown(); th.join(timeout=3)

def test_rejects_path_traversal_and_published_files_read_only(tmp_path):
    s=PublicationStore(tmp_path); s.create_dataset('d',{},'c')
    with pytest.raises(ValidationError): s.create_upload('d','r',[art('../escape',b'x')],{},'c')
    u=s.create_upload('d','r',[art('x',b'x')],{},'c'); s.append_artifact(u['upload_id'],'x',0,b'x'); s.publish_upload(u['upload_id'],[],'c')
    if os.name=='posix': assert (tmp_path/'public/datasets/d/releases/r/x').stat().st_mode & 0o222 == 0

def test_upload_session_is_private_to_dataset_owner(tmp_path):
    from wsgiref.simple_server import make_server
    cp = tmp_path / 'creds'
    _, owner_token = issue_credential(cp, label='owner', can_create_datasets=True)
    _, other_token = issue_credential(cp, label='other', can_create_datasets=True)
    store = PublicationStore(tmp_path / 'store')
    app = PublishingApplication(store, CredentialRegistry(cp))
    srv = make_server('127.0.0.1', 0, app)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    try:
        owner = PublishingClient(f'http://127.0.0.1:{srv.server_port}', owner_token)
        other = PublishingClient(f'http://127.0.0.1:{srv.server_port}', other_token)
        owner.create_dataset('d')
        upload = owner.create_upload('d', 'r', [art('x', b'x')])
        with pytest.raises(RuntimeError, match='403'):
            other.upload_status(upload['upload_id'])
    finally:
        srv.shutdown()
        th.join(timeout=3)

def test_resume_directory_refuses_changed_local_files(tmp_path):
    from wsgiref.simple_server import make_server
    cp=tmp_path/'creds'; _,token=issue_credential(cp,label='p',can_create_datasets=True)
    store=PublicationStore(tmp_path/'store'); app=PublishingApplication(store,CredentialRegistry(cp))
    srv=make_server('127.0.0.1',0,app); th=threading.Thread(target=srv.serve_forever,daemon=True); th.start()
    try:
        root=tmp_path/'release'; root.mkdir(); (root/'x').write_bytes(b'good')
        c=PublishingClient(f'http://127.0.0.1:{srv.server_port}',token); c.create_dataset('d')
        upload=c.create_upload('d','r',[art('x',b'good')]); (root/'x').write_bytes(b'changed')
        with pytest.raises(ValueError,match='does not match'):
            c.resume_directory(upload['upload_id'],root)
    finally:
        srv.shutdown(); th.join(timeout=3)
