from __future__ import annotations
import argparse, json, os
from pathlib import Path
from wsgiref.simple_server import make_server
from .auth import CredentialRegistry, issue_credential, revoke_credential
from .client import PublishingClient
from .core import PublicationStore
from .service import PublishingApplication

def main(argv=None):
    p=argparse.ArgumentParser(prog='ephys-atlas-publish'); s=p.add_subparsers(dest='cmd',required=True)
    q=s.add_parser('serve'); q.add_argument('--storage',type=Path,required=True); q.add_argument('--credentials',type=Path,required=True); q.add_argument('--host',default='127.0.0.1'); q.add_argument('--port',type=int,default=8080); q.add_argument('--validator-command')
    q=s.add_parser('credential-create'); q.add_argument('--credentials',type=Path,required=True); q.add_argument('--label',required=True); q.add_argument('--can-create-datasets',action='store_true')
    q=s.add_parser('credential-revoke'); q.add_argument('--credentials',type=Path,required=True); q.add_argument('credential_id')
    for name in ('dataset-create','publish','archive'):
        q=s.add_parser(name); q.add_argument('--url',required=True); q.add_argument('--token',default=os.getenv('IBL_PUBLISH_TOKEN')); q.add_argument('dataset_id')
        if name=='dataset-create': q.add_argument('--title')
        if name=='publish': q.add_argument('release_id'); q.add_argument('directory',type=Path); q.add_argument('--alias',action='append',default=[])
    q=s.add_parser('resume'); q.add_argument('--url',required=True); q.add_argument('--token',default=os.getenv('IBL_PUBLISH_TOKEN')); q.add_argument('upload_id'); q.add_argument('directory',type=Path); q.add_argument('--alias',action='append',default=[])
    a=p.parse_args(argv)
    if a.cmd=='serve':
        app=PublishingApplication(PublicationStore(a.storage,validator_command=a.validator_command),CredentialRegistry(a.credentials)); make_server(a.host,a.port,app).serve_forever()
    elif a.cmd=='credential-create':
        cid,token=issue_credential(a.credentials,label=a.label,can_create_datasets=a.can_create_datasets); print(json.dumps({'credential_id':cid,'token':token},indent=2))
    elif a.cmd=='credential-revoke': revoke_credential(a.credentials,a.credential_id)
    else:
        if not a.token: p.error('publisher token required via --token or IBL_PUBLISH_TOKEN')
        c=PublishingClient(a.url,a.token)
        if a.cmd=='dataset-create': print(json.dumps(c.create_dataset(a.dataset_id,{'title':a.title} if a.title else {}),indent=2))
        elif a.cmd=='publish': print(json.dumps(c.publish_directory(a.dataset_id,a.release_id,a.directory,a.alias),indent=2))
        elif a.cmd=='resume': print(json.dumps(c.resume_directory(a.upload_id,a.directory,a.alias),indent=2))
        else: print(json.dumps(c.archive_dataset(a.dataset_id),indent=2))
    return 0
