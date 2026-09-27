"""Publish a prospective research observation using the existing signed ingestion key."""
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.request

def publish(date):
    endpoint=os.environ.get("EDGE_SITE_INGEST_ENDPOINT","")
    secret=os.environ.get("EDGE_SITE_INGEST_SECRET","")
    if not endpoint or not secret:
        raise RuntimeError("Research observation configuration missing")
    endpoint=endpoint.rsplit("/",1)[0]+"/research"
    body=json.dumps({"date":date},separators=(",",":")).encode()
    timestamp=str(int(time.time()))
    nonce=secrets.token_hex(16)
    signature=hmac.new(secret.encode(),timestamp.encode()+b"."+nonce.encode()+b"."+body,hashlib.sha256).hexdigest()
    request=urllib.request.Request(endpoint,data=body,method="POST",headers={
        "Content-Type":"application/json","X-Edge-Timestamp":timestamp,
        "X-Edge-Nonce":nonce,"X-Edge-Signature":signature})
    with urllib.request.urlopen(request,timeout=45) as response:
        if response.status!=200:
            raise RuntimeError("Research observation HTTP error")
        result=json.load(response)
        if result.get("status")=="failed":
            raise RuntimeError("Research observation rejected")
    return result
