import os
import uuid
import json
import time
import hashlib
import asyncio
import base64
import websockets
from pathlib import Path
from dotenv import load_dotenv
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# Load .env from parent directory (Personalized Agents Hackathon/)
load_dotenv(Path(__file__).parent.parent / ".env")

OPENCLAW_WS_URL = os.getenv(
    "OPENCLAW_WS_URL",
    "wss://18789-01kncppres6c7avpmnb2c43n2e.cloudspaces.litng.ai"
)
OPENCLAW_API_KEY = os.getenv("OPENCLAW_API_KEY", "")

DEFAULT_SESSION_KEY = "agent:main:main"

# Client identity constants required by the gateway schema
CLIENT_ID = "cli"
CLIENT_MODE = "cli"
CLIENT_PLATFORM = "server"
CLIENT_VERSION = "1.0.0"
ROLE = "operator"
SCOPES = ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"]

# Persist device keypair next to this file so the same device ID is reused across restarts
_DEVICE_KEY_FILE = Path(__file__).parent / ".device_private_key.pem"


def _load_or_create_device_identity():
    """Load persisted Ed25519 keypair or generate and save a new one."""
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PublicFormat, PrivateFormat, NoEncryption, load_pem_private_key
    )

    if _DEVICE_KEY_FILE.exists():
        pem_data = _DEVICE_KEY_FILE.read_bytes()
        private_key = load_pem_private_key(pem_data, password=None)
        print(f"[DEVICE] Loaded existing device keypair from {_DEVICE_KEY_FILE}")
    else:
        private_key = Ed25519PrivateKey.generate()
        pem_data = private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
        _DEVICE_KEY_FILE.write_bytes(pem_data)
        _DEVICE_KEY_FILE.chmod(0o600)
        print(f"[DEVICE] Generated new device keypair, saved to {_DEVICE_KEY_FILE}")

    public_key = private_key.public_key()
    raw_public_key = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    device_id = hashlib.sha256(raw_public_key).hexdigest()
    public_key_b64 = base64.urlsafe_b64encode(raw_public_key).rstrip(b"=").decode()

    print(f"[DEVICE] Device ID: {device_id}")
    return private_key, device_id, public_key_b64


# Load once at module startup
_PRIVATE_KEY, _DEVICE_ID, _PUBLIC_KEY_B64 = _load_or_create_device_identity()


def _sign_challenge(private_key, device_id: str, signed_at_ms: int, token: str, nonce: str) -> str:
    """Sign the challenge payload using Ed25519 and return base64url-encoded signature."""
    scopes_str = ",".join(SCOPES)
    payload = f"v2|{device_id}|{CLIENT_ID}|{CLIENT_MODE}|{ROLE}|{scopes_str}|{signed_at_ms}|{token}|{nonce}"
    signature_bytes = private_key.sign(payload.encode("utf-8"))
    return base64.urlsafe_b64encode(signature_bytes).rstrip(b"=").decode()


def _build_connect_payload(device_id: str, public_key_b64: str, signature: str,
                            signed_at_ms: int, nonce: str) -> dict:
    return {
        "type": "req",
        "id": str(uuid.uuid4()),
        "method": "connect",
        "params": {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": CLIENT_ID,
                "version": CLIENT_VERSION,
                "platform": CLIENT_PLATFORM,
                "mode": CLIENT_MODE,
            },
            "role": ROLE,
            "scopes": SCOPES,
            "auth": {"token": OPENCLAW_API_KEY},
            "device": {
                "id": device_id,
                "publicKey": public_key_b64,
                "signature": signature,
                "signedAt": signed_at_ms,
                "nonce": nonce,
            },
        },
    }


async def _ws_connect_and_auth(ws) -> bool:
    """Full OpenClaw handshake: receive challenge → sign → send connect → await ok."""
    # Use the persistent device identity loaded at startup
    private_key, device_id, public_key_b64 = _PRIVATE_KEY, _DEVICE_ID, _PUBLIC_KEY_B64

    # Step 1: Receive the gateway's connect.challenge
    nonce = ""
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        data = json.loads(raw)
        print(f"[DEBUG] Gateway challenge: {data}")
        if data.get("type") == "event" and data.get("event") == "connect.challenge":
            nonce = data.get("payload", {}).get("nonce", "")
    except asyncio.TimeoutError:
        print("[DEBUG] No challenge received within 10s, proceeding without nonce")

    # Step 2: Sign the challenge
    signed_at_ms = int(time.time() * 1000)
    signature = _sign_challenge(private_key, device_id, signed_at_ms, OPENCLAW_API_KEY, nonce)

    # Step 3: Send connect request
    payload = _build_connect_payload(device_id, public_key_b64, signature, signed_at_ms, nonce)
    req_id = payload["id"]
    print(f"[DEBUG] Sending connect (device_id={device_id[:12]}...)")
    await ws.send(json.dumps(payload))

    # Step 4: Wait for hello-ok
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        data = json.loads(raw)
        print(f"[DEBUG] Auth response: {data}")
        if data.get("type") == "res" and data.get("id") == req_id:
            return data.get("ok", False)


async def health() -> bool:
    """Check if the OpenClaw gateway is reachable and auth succeeds."""
    try:
        async with websockets.connect(OPENCLAW_WS_URL, open_timeout=5) as ws:
            return await _ws_connect_and_auth(ws)
    except Exception:
        return False


async def send_message(message: str, session_id: str = DEFAULT_SESSION_KEY) -> str:
    """Send a message to an OpenClaw agent via WebSocket RPC and return the response."""
    try:
        async with websockets.connect(OPENCLAW_WS_URL, open_timeout=10) as ws:
            ok = await _ws_connect_and_auth(ws)
            if not ok:
                return "Error: OpenClaw connection rejected"

            # Send the chat message
            chat_req_id = str(uuid.uuid4())
            await ws.send(json.dumps({
                "type": "req",
                "id": chat_req_id,
                "method": "chat.send",
                "params": {
                    "sessionKey": session_id,
                    "message": message,
                    "deliver": False,
                    "idempotencyKey": str(uuid.uuid4()),
                },
            }))

            # Collect streamed response
            delta_parts: list[str] = []
            final_text: str | None = None

            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=60)
                data = json.loads(raw)

                if data.get("type") == "res" and data.get("id") == chat_req_id:
                    if not data.get("ok"):
                        return f"Error: chat.send rejected: {data.get('payload', '')}"

                if data.get("type") == "event" and data.get("event") == "chat":
                    payload = data.get("payload", {})
                    if payload.get("sessionKey") != session_id:
                        continue
                    state = payload.get("state")
                    msg = payload.get("message") or {}
                    text = "".join(
                        part.get("text", "")
                        for part in msg.get("content", [])
                        if part.get("type") == "text"
                    )
                    if state == "final":
                        final_text = text
                    elif state == "delta" and text:
                        delta_parts.append(text)

                    if state in ("final", "error", "aborted"):
                        break

            result = final_text if final_text is not None else "".join(delta_parts)
            return result if result else "No response received"

    except asyncio.TimeoutError:
        return "Error: Request to OpenClaw timed out"
    except Exception as e:
        return f"Error: {str(e)}"


async def list_agents() -> list:
    """List all available agents."""
    try:
        async with websockets.connect(OPENCLAW_WS_URL, open_timeout=5) as ws:
            ok = await _ws_connect_and_auth(ws)
            if not ok:
                return []
            req_id = str(uuid.uuid4())
            await ws.send(json.dumps({"type": "req", "id": req_id, "method": "agents.list", "params": {}}))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(raw)
                if data.get("type") == "res" and data.get("id") == req_id:
                    return data.get("payload", [])
    except Exception:
        return []
