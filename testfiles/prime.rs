fn find_first_prime(numbers: &[i32]) -> i32 {
    for n in numbers {
        if *n < 2 {
            continue;
        }
        let mut is_prime = true;
        let mut d = 2;
        while d * d <= *n {
            if n % d == 0 {
                is_prime = false;
                break;
            }
            d = d + 1;
        }
        if is_prime {
            return *n;
        }
    }
    return -1;
}
