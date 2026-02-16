release: python manage.py migrate --noinput && python manage.py collectstatic --noinput --verbosity 2
web: gunicorn offline_exam_system.wsgi:application --bind 0.0.0.0:$PORT --workers 4 --threads 2 --worker-class sync --timeout 60
