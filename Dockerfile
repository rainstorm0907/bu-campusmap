# 캠퍼스맵 서버 (web + API 를 한 주소로 제공)
FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt server/
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/ server/
COPY web/ web/
WORKDIR /app/server
# DB·업로드 파일은 /data 에 저장 (배포 서비스에서 볼륨/디스크를 /data 에 연결)
ENV CAMPUS_DB=/data/campus.db CAMPUS_UPLOADS=/data/uploads PORT=8000
EXPOSE 8000
CMD python seed.py && gunicorn -w 2 -b 0.0.0.0:$PORT app:app
