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

# WhiteNoise is configured via middleware in settings.py (MIDDLEWARE list).
# Modern whitenoise (6.x+) uses middleware approach, not WSGI wrapping.
# No need to import or wrap here.
