#include <stdio.h>

int findFirstPrime(int numbers[], int size) {
    for (int i = 0; i < size; i++) {
        int n = numbers[i];
        if (n < 2) {
            continue;
        }
        int isPrime = 1;
        int d = 2;
        while (d * d <= n) {
            if (n % d == 0) {
                isPrime = 0;
                break;
            }
            d = d + 1;
        }
        if (isPrime) {
            return n;
        }
    }
    return -1;
}

int classify(int score) {
    switch (score / 10) {
        case 10:
        case 9:
            return 'A';
        case 8:
            return 'B';
        default:
            return 'F';
    }
}
