from __future__ import annotations
from flask import Flask

def register_routes(app: Flask) -> None:
    from .main import main_bp
    from .ask import ask_bp
    from .resumes import resumes_bp
    # optional
    try:    from .interviews import interviews_bp
    except: interviews_bp = None
    try:    from .employer import employer_bp
    except: employer_bp = None
    try:    from .state import state_bp
    except: state_bp = None
    try:    from .insights import insights_bp
    except: insights_bp = None
    try:    from .auth import auth_bp
    except: auth_bp = None
    try:    from .billing import billing_bp
    except: billing_bp = None

    app.register_blueprint(main_bp)
    app.register_blueprint(ask_bp)
    app.register_blueprint(resumes_bp)
    if interviews_bp: app.register_blueprint(interviews_bp)
    if employer_bp:   app.register_blueprint(employer_bp)
    if state_bp:      app.register_blueprint(state_bp)
    if insights_bp:   app.register_blueprint(insights_bp)
    if auth_bp:       app.register_blueprint(auth_bp)
    if billing_bp:    app.register_blueprint(billing_bp)
