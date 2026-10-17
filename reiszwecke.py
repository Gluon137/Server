def run(n):
    k =0
    for i in range(n):
        if random.random()< 0.6:
            k+=1
    return k
import random

def runs(anz):
    n= 200
    for i in range(anz):
        n = run(n)
    return n

def main():
    n15=0
    n16=0
    for i in range(1000000):
        
        k = runs(5)
        if k==15:
            n15+=1
        elif k==16:
            n16+=1
    print(f"n15: {n15}, n16: {n16}")
main()

