# jobcus/routes/admin.py
from flask import Blueprint, render_template
from flask_login import login_required

# If you have a custom decorator, uncomment the next line and apply it:
# from ..security.abuse_guard import require_superadmin

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

@admin_bp.get("/settings")
@login_required
# @require_superadmin  # ← enable if you have it
def settings():
    return render_template("admin/settings.html")
