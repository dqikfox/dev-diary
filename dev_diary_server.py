"""The Dev Diary server entry point.

Kept as its own file so the command line ENDS with the script name. The
house tooling identifies a service by the marker at the end of a command
line, and "app.py" would be too generic to trust.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import app, PORT  # noqa: E402

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("DEV_DIARY_PORT", PORT)),
                log_level="warning", access_log=False)
