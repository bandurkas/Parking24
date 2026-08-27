#!/bin/sh
# pg_dump в /opt/parking24/backups, ротация 14 дней. Cron: 0 3 * * * sh /opt/parking24/docker/backup.sh
set -e
DIR=/opt/parking24/backups
mkdir -p "$DIR"
docker exec parking24-db pg_dump -U parking24 -Fc parking24 > "$DIR/parking24-$(date +%F).dump"
find "$DIR" -name 'parking24-*.dump' -mtime +14 -delete
