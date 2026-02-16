release: python manage.py migrate && python manage.py collectstatic --noinput
web: gunicorn offline_exam_system.wsgi:application --bind 0.0.0.0:$PORT --workers 4
