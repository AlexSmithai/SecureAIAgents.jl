using Sphinx

result = call_smart_contract("getVoteCount", ["0x1"])
println("Smart contract result: $result")
