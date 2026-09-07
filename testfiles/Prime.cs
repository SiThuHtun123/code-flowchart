using System;
using System.Collections.Generic;

namespace Demo
{
    public class Solver
    {
        public int FindFirstPrime(List<int> numbers)
        {
            foreach (int n in numbers)
            {
                if (n < 2)
                {
                    continue;
                }
                bool isPrime = true;
                int d = 2;
                while (d * d <= n)
                {
                    if (n % d == 0)
                    {
                        isPrime = false;
                        break;
                    }
                    d = d + 1;
                }
                if (isPrime)
                {
                    return n;
                }
            }
            return -1;
        }

        public int ReadNumber(string text)
        {
            try
            {
                return int.Parse(text);
            }
            catch (FormatException)
            {
                Console.WriteLine("bad input");
                return 0;
            }
            finally
            {
                Console.WriteLine("done");
            }
        }
    }
}
