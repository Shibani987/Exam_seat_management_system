release: bash -c "python manage.py migrate --no-input"
web: gunicorn offline_exam_system.wsgi:application --bind 0.0.0.0:$PORT --workers 4 --timeout 120
