# app.py (repo root)

import os
from dotenv import load_dotenv
from jobcus import create_app
from jobcus.routes.auth import auth_bp  # ✅ Import the auth blueprint

load_dotenv()  # read .env

# Gunicorn looks for "app"
app = create_app()

# ✅ Register blueprint
app.register_blueprint(auth_bp)

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
