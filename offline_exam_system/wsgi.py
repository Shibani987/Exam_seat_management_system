"""
WSGI config for offline_exam_system project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os
import sys

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'offline_exam_system.settings')

application = get_wsgi_application()

# Ensure WhiteNoise can serve static files by wrapping the application
# This adds robustness to static file serving in production
from whitenoise.wsgi import WhiteNoise

# Additional whiteNoise configuration for maximum compatibility
static_root = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'staticfiles')
application = WhiteNoise(
    application,
    root=static_root,
    prefix='static/',
    max_age=31536000,  # 1 year cache
    mimetypes={
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
    }
)
