import os
import httpx

OPENCLAW_BASE_URL = os.getenv(
    "OPENCLAW_BASE_URL",
    "https://18789-01kncppres6c7avpmnb2c43n2e.cloudspaces.litng.ai"
)
OPENCLAW_API_KEY = os.getenv("OPENCLAW_API_KEY", "")


def _headers():
    headers = {"Content-Type": "application/json"}
    if OPENCLAW_API_KEY:
        headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
    return headers


async def health() -> bool:
    """Check if the OpenClaw gateway is healthy."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OPENCLAW_BASE_URL}/health", headers=_headers())
            return resp.status_code == 200
    except Exception:
        return False


async def send_message(message: str, agent: str = "default") -> str:
    """Send a message to an OpenClaw agent using the OpenAI-compatible endpoint."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OPENCLAW_BASE_URL}/v1/chat/completions",
                headers=_headers(),
                json={
                    "model": f"openclaw/{agent}",
                    "messages": [{"role": "user", "content": message}],
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                # OpenAI-style response format
                return data["choices"][0]["message"]["content"]
            else:
                return f"Error: OpenClaw returned status {resp.status_code}"
    except httpx.TimeoutException:
        return "Error: Request to OpenClaw timed out"
    except httpx.ConnectError:
        return "Error: Could not connect to OpenClaw gateway. Is it running?"
    except Exception as e:
        return f"Error: {str(e)}"


async def list_agents() -> list:
    """List all available agents."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OPENCLAW_BASE_URL}/v1/models", headers=_headers())
            if resp.status_code == 200:
                return resp.json()
            return []
    except Exception:
        return []
