function findFirstPrime(numbers) {
  for (let i = 0; i < numbers.length; i++) {
    const n = numbers[i];
    if (n < 2) {
      continue;
    }
    let isPrime = true;
    let d = 2;
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
