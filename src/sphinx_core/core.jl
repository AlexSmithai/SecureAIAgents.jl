mutable struct AIAgent
    id::Int
    role::String
    state::Dict
    decision_model::Function
    nn_model::Union{NeuralNetModel, Nothing}

    function AIAgent(id::Int, role::String, decision_model::Function, use_nn::Bool=false)
        state = Dict("key" => "", "vote" => nothing, "tx_hash" => nothing, "block_height" => 0)
        nn_model = use_nn ? NeuralNetModel() : nothing
        new(id, role, state, decision_model, nn_model)
    end
end

mutable struct NeuralNetModel
    model::Chain
    history::Vector{Tuple{Vector{Float32}, Bool}}
end

function NeuralNetModel()
    model = Chain(
        Dense(2, 10, relu),
        Dense(10, 2),
        softmax
    )
    history = Vector{Tuple{Vector{Float32}, Bool}}()
    return NeuralNetModel(model, history)
end

function call_tee_secure_function(input::String)
    lib_path = joinpath(@__DIR__, "../../lib/libtee.so")
    lib = try
        Libdl.dlopen(lib_path)
    catch e
        error("Failed to load libtee.so: $e. Ensure the library is compiled in lib/.")
    end

    sym = try
        Libdl.dlsym(lib, :tee_secure_process)
    catch e
        Libdl.dlclose(lib)
        error("Failed to find tee_secure_process: $e")
    end

    result_ptr = try
        ccall(sym, Cstring, (Cstring,), input)
    catch e
        Libdl.dlclose(lib)
        error("Failed to call tee_secure_process: $e")
    end

    result = unsafe_string(result_ptr)
    Libdl.dlclose(lib)
    return result
end
