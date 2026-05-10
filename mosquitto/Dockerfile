FROM eclipse-mosquitto:latest

# Copy configuration files
COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY acl /mosquitto/config/acl
COPY passwd /mosquitto/config/passwd

# Set correct permissions and ownership
RUN chown mosquitto:mosquitto /mosquitto/config/passwd /mosquitto/config/acl && \
    chmod 0700 /mosquitto/config/passwd /mosquitto/config/acl

# Convert plaintext passwords to hashed format
RUN mosquitto_passwd -U /mosquitto/config/passwd

# Run Mosquitto
CMD ["mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
