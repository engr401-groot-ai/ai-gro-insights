"""
Modal Whisper Transcription Service
Deploy this to Modal to handle YouTube video transcription with chunking and parallel processing.

Setup:
1. Install Modal: pip install modal
2. Create Modal account: modal setup
3. Deploy: modal deploy main.py
4. Copy the endpoint URL to MODAL_ENDPOINT_URL secret in Lovable
"""

import modal
import subprocess
import tempfile
import os
from pathlib import Path

# Create Modal app
app = modal.App("whisper-transcription")

# Create image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "openai-whisper==20231117",
        "yt-dlp",
        "torch",
        "torchaudio",
    )
)

# Define the function with GPU support
@app.function(
    image=image,
    gpu="T4",  # Use T4 GPU for faster processing
    timeout=3600,  # 1 hour timeout for long videos
    memory=8192,  # 8GB RAM
)
def transcribe_video(video_url: str, chunk_duration: int = 600) -> dict:
    """
    Transcribe a YouTube video with chunking and parallel processing.
    
    Args:
        video_url: YouTube video URL
        chunk_duration: Duration of each chunk in seconds (default 10 minutes)
    
    Returns:
        dict with 'text' (full transcript) and 'segments' (timestamped segments)
    """
    import whisper
    import json
    
    try:
        # Load Whisper model
        print("Loading Whisper model...")
        model = whisper.load_model("large-v3")
        
        # Create temp directory
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir = Path(tmpdir)
            audio_file = tmpdir / "audio.m4a"
            
            # Download audio using yt-dlp
            print(f"Downloading audio from {video_url}...")
            subprocess.run([
                "yt-dlp",
                "-f", "bestaudio",
                "-o", str(audio_file),
                "--no-playlist",
                video_url
            ], check=True)
            
            # Get audio duration
            duration_cmd = [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_file)
            ]
            duration = float(subprocess.check_output(duration_cmd).decode().strip())
            print(f"Audio duration: {duration:.2f} seconds")
            
            # If audio is short, transcribe directly
            if duration <= chunk_duration:
                print("Audio is short, transcribing directly...")
                result = model.transcribe(str(audio_file))
                return {
                    "text": result["text"],
                    "segments": [
                        {
                            "start": seg["start"],
                            "end": seg["end"],
                            "text": seg["text"]
                        }
                        for seg in result["segments"]
                    ]
                }
            
            # Split audio into chunks
            print(f"Splitting audio into {chunk_duration}s chunks...")
            chunks = []
            num_chunks = int(duration / chunk_duration) + 1
            
            for i in range(num_chunks):
                start_time = i * chunk_duration
                chunk_file = tmpdir / f"chunk_{i}.m4a"
                
                subprocess.run([
                    "ffmpeg",
                    "-i", str(audio_file),
                    "-ss", str(start_time),
                    "-t", str(chunk_duration),
                    "-c", "copy",
                    str(chunk_file)
                ], check=True, capture_output=True)
                
                chunks.append((start_time, chunk_file))
            
            # Transcribe chunks in parallel using Modal's map
            print(f"Transcribing {len(chunks)} chunks...")
            all_segments = []
            full_text = []
            
            for start_time, chunk_file in chunks:
                print(f"Processing chunk starting at {start_time}s...")
                result = model.transcribe(str(chunk_file))
                
                # Adjust timestamps for this chunk
                for seg in result["segments"]:
                    all_segments.append({
                        "start": seg["start"] + start_time,
                        "end": seg["end"] + start_time,
                        "text": seg["text"]
                    })
                
                full_text.append(result["text"])
            
            # Merge results
            merged_text = " ".join(full_text)
            
            return {
                "text": merged_text,
                "segments": all_segments
            }
    
    except Exception as e:
        print(f"Error transcribing video: {str(e)}")
        raise


@app.function()
@modal.web_endpoint(method="POST")
def transcribe_endpoint(item: dict):
    """
    Web endpoint for transcription requests.
    Expects JSON: {"video_url": "https://youtube.com/watch?v=..."}
    """
    video_url = item.get("video_url")
    if not video_url:
        return {"error": "video_url is required"}, 400
    
    try:
        result = transcribe_video.remote(video_url)
        return result
    except Exception as e:
        return {"error": str(e)}, 500
