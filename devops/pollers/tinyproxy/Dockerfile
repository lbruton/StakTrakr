FROM alpine:3.20

RUN apk add --no-cache tinyproxy iproute2 socat \
    && mkdir -p /var/log/tinyproxy \
    && chown tinyproxy:tinyproxy /var/log/tinyproxy

COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8888

ENTRYPOINT ["/entrypoint.sh"]
