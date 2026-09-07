<?php
function findFirstPrime($numbers) {
    foreach ($numbers as $n) {
        if ($n < 2) {
            continue;
        }
        $isPrime = true;
        $d = 2;
        while ($d * $d <= $n) {
            if ($n % $d == 0) {
                $isPrime = false;
                break;
            }
            $d = $d + 1;
        }
        if ($isPrime) {
            return $n;
        }
    }
    return -1;
}
