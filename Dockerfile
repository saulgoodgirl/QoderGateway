FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src
ENV HOST=0.0.0.0
ENV PORT=5050
ENV DB_PATH=/app/data/qoder2api.db

EXPOSE 5050

CMD [" python\, \-m\, \qoder2api.app\]
