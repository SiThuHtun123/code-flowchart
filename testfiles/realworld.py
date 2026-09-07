"""Messy, realistic student code — the kind that actually gets written."""

import sys
from collections import defaultdict


def solve():
    n, m = map(int, input().split())
    graph = defaultdict(list)

    for _ in range(m):
        a, b, w = map(int, input().split())
        graph[a].append((b, w))
        graph[b].append((a, w))

    dist = [float('inf')] * (n + 1)
    dist[1] = 0
    visited = [False] * (n + 1)

    for _ in range(n):
        u = -1
        best = float('inf')
        for v in range(1, n + 1):
            if not visited[v] and dist[v] < best:
                best = dist[v]
                u = v

        if u == -1:
            break

        visited[u] = True
        for v, w in graph[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w

    return dist[n] if dist[n] != float('inf') else -1


class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance
        self.history = []

    def withdraw(self, amount):
        if amount <= 0:
            raise ValueError("amount must be positive")

        if amount > self.balance:
            print(f"Insufficient funds: have {self.balance}, need {amount}")
            return False

        self.balance -= amount
        self.history.append(('withdraw', amount))
        return True

    def apply_interest(self, rate):
        try:
            if rate < 0:
                raise ValueError("negative rate")
            earned = self.balance * rate
            self.balance += earned
        except ValueError as e:
            print(f"Skipping interest: {e}")
            earned = 0
        except TypeError:
            print("Bad rate type")
            earned = 0
        finally:
            self.history.append(('interest', rate))
        return earned


def parse_config(path):
    settings = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' not in line:
                    print(f"Skipping malformed line: {line}")
                    continue
                key, value = line.split('=', 1)
                if value.isdigit():
                    settings[key.strip()] = int(value)
                elif value.lower() in ('true', 'false'):
                    settings[key.strip()] = value.lower() == 'true'
                else:
                    settings[key.strip()] = value.strip()
    except FileNotFoundError:
        print("Config not found, using defaults")
        return {}
    return settings


def grade_students(scores):
    results = {}
    for name, marks in scores.items():
        if len(marks) == 0:
            results[name] = 'N/A'
            continue

        total = 0
        dropped = 0
        for m in marks:
            if m < 0:
                dropped += 1
                continue
            total += m

        count = len(marks) - dropped
        if count == 0:
            results[name] = 'N/A'
            continue

        avg = total / count
        while avg > 100:
            avg = avg / 10

        if avg >= 90:
            results[name] = 'A'
        elif avg >= 80:
            results[name] = 'B'
        elif avg >= 70:
            results[name] = 'C'
        else:
            results[name] = 'F'

    return results


if __name__ == '__main__':
    print(solve())
