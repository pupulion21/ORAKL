# Mandatory LOCAL_SIMULATION Gating for P1 Test and Deployment Execution

To strictly isolate ongoing P1 development from live production risks, all deployment scripts, migration tasks, and test harnesses must pass a blocking `LOCAL_SIMULATION` preflight (Chain ID `31337`, local RPC `http://127.0.0.1:8546`, synthetic parameter fixtures with `Tcap = 100 ether`). Any operation attempting public broadcast, production network interaction, or unauthorized nonrefundable creation fee collection (`F`) is rejected with a fatal error.
