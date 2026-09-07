def grade(scores):
    total = 0
    count = 0
    for s in scores:
        if s < 0:
            print("bad score")
            continue
        total += s
        count = count + 1
    if count == 0:
        return "no scores"
    average = total / count
    if average >= 90:
        return "A"
    elif average >= 80:
        return "B"
    else:
        return "C"
