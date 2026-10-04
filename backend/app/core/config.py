import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
TEMP_DIR = BASE_DIR / "temp"
MODEL_CACHE_DIR = Path(
    os.getenv(
        "ORTHO_AI_MODEL_DIR",
        str(Path(os.getenv("LOCALAPPDATA", Path.home() / ".cache")) / "ORTHO_AI" / "models"),
    )
)
CASES_PATH = BASE_DIR / "data" / "cases.json"
OLLAMA_URL = "http://localhost:11434"
MODEL_NAME = "llama3.2"
EMBEDDING_MODEL_NAME = "nomic-embed-text"
MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3307"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "ortho_ai")

UPLOAD_DIR.mkdir(exist_ok=True, parents=True)
TEMP_DIR.mkdir(exist_ok=True, parents=True)
MODEL_CACHE_DIR.mkdir(exist_ok=True, parents=True)
CASES_PATH.parent.mkdir(exist_ok=True, parents=True)
