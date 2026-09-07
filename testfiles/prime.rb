def find_first_prime(numbers)
  for n in numbers
    if n < 2
      next
    end
    is_prime = true
    d = 2
    while d * d <= n
      if n % d == 0
        is_prime = false
        break
      end
      d = d + 1
    end
    if is_prime
      return n
    end
  end
  return -1
end
