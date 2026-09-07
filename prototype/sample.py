def find_first_prime(numbers):
    for n in numbers:
        if n < 2:
            continue
        is_prime = True
        d = 2
        while d * d <= n:
            if n % d == 0:
                is_prime = False
                break
            d = d + 1
        if is_prime:
            return n
    return None
