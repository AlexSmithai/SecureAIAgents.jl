CC = gcc
CFLAGS = -shared -fPIC
TARGET = libtee.so

all: $(TARGET)

$(TARGET): tee_secure.c
    $(CC) $(CFLAGS) -o $(TARGET) tee_secure.c

clean:
    rm -f $(TARGET)
