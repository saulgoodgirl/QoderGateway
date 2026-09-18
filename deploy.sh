#!/usr/bin/env bash
set -e
echo "=== Building and starting QoderGateway container ==="
docker compose build
docker compose up -d
echo "=== Container Status ==="
docker ps --filter name=qodergateway
