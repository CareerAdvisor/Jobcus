from flask import Blueprint, render_template
from ..security.admin import require_superadmin  # ← import the decorator

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

@admin_bp.get("/settings")
@require_superadmin(with_mfa=True)  # ← role check + 2FA required
def settings():
    return render_template("admin/settings.html")
