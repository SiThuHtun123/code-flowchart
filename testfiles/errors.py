def read_numbers(path):
    numbers = []
    try:
        with open(path) as f:
            for line in f:
                value = int(line)
                if value < 0:
                    raise ValueError("negative")
                numbers.append(value)
    except ValueError:
        print("bad input")
        return []
    except OSError:
        return []
    finally:
        print("done reading")
    return numbers
