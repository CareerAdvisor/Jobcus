import os, stripe
from flask import Blueprint, request, jsonify, url_for
from flask_login import current_user

billing_bp = Blueprint("billing", __name__)
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

PRICE_IDS = {
    "weekly":   os.environ.get("STRIPE_PRICE_WEEKLY"),
    "standard": os.environ.get("STRIPE_PRICE_STANDARD"),
    "premium":  os.environ.get("STRIPE_PRICE_PREMIUM"),
}

@billing_bp.post("/api/stripe/create-checkout-session")
def create_checkout_session():
    data = request.get_json(silent=True) or {}
    plan = (data.get("plan") or "standard").lower()
    price_id = PRICE_IDS.get(plan)
    if not price_id:
        return jsonify(error="bad_request", message="Unknown plan"), 400
    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=url_for("main.pricing", _external=True) + "?status=success",
        cancel_url=url_for("main.pricing", _external=True) + "?status=cancel",
        client_reference_id=getattr(current_user, "id", None),
        customer_email=getattr(current_user, "email", None),
        allow_promotion_codes=True,
    )
    return jsonify(id=session.id, url=session.url)
