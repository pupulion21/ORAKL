#!/usr/bin/env python3
"""Exact synthetic-integer stress of the selected interval rule, not an incentive-security proof."""
from itertools import product
import json
cases=0;worst=0;example=None
for n in range(1,7):
 for stakes in product(range(1,5),repeat=n):
  total=sum(stakes)
  for proposal in (1,2,3,7,10,31):
   prefix=0;rewards=[]
   for amount in stakes:
    rewards.append(proposal*(prefix+amount)//total-proposal*prefix//total);prefix+=amount
   assert sum(rewards)==proposal
   assert sum(stakes[i]+rewards[i] for i in reversed(range(n)))==total+proposal
   # Contiguous Sybil subdivisions telescope to the same interval allocation.
   if stakes[0]>1:
    original=rewards[0];a=1;b=stakes[0]-1
    assert proposal*a//total+(proposal*(a+b)//total-proposal*a//total)==original
   # Separated coalition intervals can move atoms relative to floor of their total share.
   coalition=[i for i in range(n) if i%2==0]
   received=sum(rewards[i] for i in coalition)
   ideal_floor=proposal*sum(stakes[i] for i in coalition)//total
   difference=received-ideal_floor
   assert abs(difference)<=len(coalition)
   if difference>worst:worst=difference;example={'P':proposal,'stakes':stakes,'coalition':coalition,'rewards':rewards,'differenceFromSingleFloor':difference}
   cases+=1
print(json.dumps({'status':'PASS','cases':cases,'units':'synthetic atomic integers','worstPositiveCoalitionDifference':worst,'example':example,'limits':'bounded enumeration; inclusion order and separated Sybil intervals can affect rounding; no proof of honest detection, arbitration or economic Sybil resistance'},indent=2))
