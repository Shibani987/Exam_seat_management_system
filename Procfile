release: python manage.py collectstatic --noinput --clear && python manage.py migrate --noinput
web: gunicorn offline_exam_system.wsgi:application --bind 0.0.0.0:$PORT --workers 4 --timeout 120
