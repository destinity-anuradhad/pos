FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

EXPOSE 8000

CMD gunicorn main:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
