# Modal Whisper Transcription Service

This is a self-hosted Whisper transcription service that runs on Modal with GPU support.

## Features

- ✅ Uses Whisper Large V3 for high-quality transcription
- ✅ Automatic audio chunking for long videos
- ✅ GPU-accelerated processing (T4)
- ✅ Handles videos of any length
- ✅ Returns full text + timestamped segments
- ✅ Built-in retry logic via Modal

## Setup & Deployment

### 1. Install Modal CLI

```bash
pip install modal
```

### 2. Authenticate with Modal

```bash
modal setup
```

This will open a browser window to authenticate with your Modal account (create one if needed).

### 3. Deploy the Service

```bash
cd modal-whisper-service
modal deploy main.py
```

After deployment, Modal will give you an endpoint URL like:
```
https://your-workspace--whisper-transcription-transcribe-endpoint.modal.run
```

### 4. Add Endpoint URL to Lovable

Copy the endpoint URL and add it as a secret in your Lovable project:
- Secret name: `MODAL_ENDPOINT_URL`
- Secret value: `https://your-workspace--whisper-transcription-transcribe-endpoint.modal.run`

## Testing

You can test the endpoint directly:

```bash
curl -X POST https://your-endpoint.modal.run \
  -H "Content-Type: application/json" \
  -d '{"video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

## Costs

Modal pricing (as of 2024):
- T4 GPU: ~$0.60/hour
- Average 10-minute video: ~2-3 minutes processing = ~$0.02-0.03
- Free tier: $30/month credits

## Monitoring

View logs and monitor your deployment:
```bash
modal app logs whisper-transcription
```

Or visit the Modal dashboard: https://modal.com/apps

## Scaling

Modal automatically scales up/down based on demand. No manual configuration needed!
