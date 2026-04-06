# Lightning AI OpenClaw environment

- Gateway starts on boot through .lightning_studio/on_start.sh

## Getting started

This template launches OpenClaw on start. You will just need to get
your personal API key and find the studio URL:

1. **Getting your API key**
   - Go to your OpenClaw dashboard
   - Navigate to Settings > API Keys
   - Create a new key or copy your existing one

2. **Finding the studio URL**
   - The studio URL is shown in the Lightning AI toolbar
   - The OpenClaw gateway runs on port 18789

## Foreclosure Defender

The `foreclosure-defender/` directory contains a FastAPI application that demonstrates:
- AI agent adversarial testing (red-teaming)
- Mortgage/foreclosure data handling
- OpenClaw gateway integration

### Running the app

```bash
cd foreclosure-defender
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```
