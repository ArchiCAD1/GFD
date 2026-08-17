# Use caddy for a simple, secure static file server
FROM caddy:2-alpine
COPY public /usr/share/caddy
EXPOSE 80
CMD ["caddy", "file-server", "--listen", ":80"]
