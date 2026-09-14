"""The judge Lambda.

It calls models and never executes learner code. The runner is the other half
of that split and never calls a model. Keeping them apart is the control that
makes token spend bounded, so nothing in this package imports from `runner`,
spawns a process, or evaluates learner input as code.
"""
