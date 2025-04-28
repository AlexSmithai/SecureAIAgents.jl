#include <string.h>
#include <stdlib.h>

char* tee_secure_process(const char* input) {
    size_t len = strlen(input);
    char* result = (char*)malloc(len + 1);
    for (size_t i = 0; i < len; i++) {
        result[i] = input[len - 1 - i];
    }
    result[len] = '\0';
    return result;
}
