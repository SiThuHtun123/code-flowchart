int findFirstPrime(int numbers[], int size) {
    for (int i = 0; i < size; i++) {
        int n = numbers[i];
        if (n < 2) {
            continue;
        }
        bool isPrime = true;
        int d = 2;
        while (d * d <= n) {
            if (n % d == 0) {
                isPrime = false;
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
