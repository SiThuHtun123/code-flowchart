public class Solver {
    public int findFirstPrime(int[] numbers) {
        for (int n : numbers) {
            if (n < 2) {
                continue;
            }
            boolean isPrime = true;
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
}
