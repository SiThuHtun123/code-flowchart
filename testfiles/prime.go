package main

func findFirstPrime(numbers []int) int {
	for i := 0; i < len(numbers); i++ {
		n := numbers[i]
		if n < 2 {
			continue
		}
		isPrime := true
		d := 2
		for d*d <= n {
			if n%d == 0 {
				isPrime = false
				break
			}
			d = d + 1
		}
		if isPrime {
			return n
		}
	}
	return -1
}

func classify(score int) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 80:
		return "B"
	default:
		return "F"
	}
}
