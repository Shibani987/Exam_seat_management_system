release: python manage.py collectstatic --noinput --clear --verbosity 2 ; python manage.py migrate --noinput 2>&1 || echo "Migration skipped or failed - DB may be unavailable"
web: gunicorn offline_exam_system.wsgi:application --bind 0.0.0.0:$PORT --workers 4 --timeout 120
