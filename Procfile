release: python manage.py migrate
web: gunicorn offline_exam_system.wsgi:application --bind 0.0.0.0:$PORT --workers 4
