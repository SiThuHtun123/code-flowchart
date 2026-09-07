interface Result {
  value: number;
  found: boolean;
}

function findFirstPrime(numbers: number[]): number | null {
  for (let i = 0; i < numbers.length; i++) {
    const n: number = numbers[i];
    if (n < 2) {
      continue;
    }
    let isPrime: boolean = true;
    let d: number = 2;
    while (d * d <= n) {
      if (n % d === 0) {
        isPrime = false;
        break;
      }
      d = d + 1;
    }
    if (isPrime) {
      return n;
    }
  }
  return null;
}
